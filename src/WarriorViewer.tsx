import ModelLoading from "./ModelLoading";
import { useEffect, useRef, useState } from "react";
import useEnvironment from "./useEnvironment";
import useWarrior from "./useWarrior";
import Materials from "./Materials";
import modelConfig from "./models";
import { LiveMocapPose, useMocap } from "./MocapProvider";
import { ModelViewerContext } from "./useModelViewer";
import useViewer from "./useViewer";
import Viewer, { type LoadedModel } from "./Viewer";

const { cameraOverrides } = modelConfig;

export default function WarriorViewer() {
  const {
    selectedModel,
    selectedModelUrl: modelUrl,
    selectedModelType,
    selectedAnimation: animationName,
    animationPaused,
    slowModeEnabled,
  } = useWarrior();
  const { environmentImageUrl, showEnvironment, exposure } = useEnvironment();
  const { active: poseMode, runtime } = useMocap();
  const { setViewer: shareViewer } = useViewer();
  const poseRuntime = runtime?.viewerRuntime;
  // With no animation chosen, play the model's first clip once.
  const playFirstClip = selectedModelType !== "player";
  const timeScale = slowModeEnabled ? 0.05 : 0.5;
  const orbit = cameraOverrides[selectedModel]?.orbit ??
    (selectedModelType === "weapon" ? "315deg 70deg 105%" : undefined);
  const target = cameraOverrides[selectedModel]?.target;
  const fov = cameraOverrides[selectedModel]?.fov;
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loaded, setLoaded] = useState<(LoadedModel & { url: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [environmentAttempt, setEnvironmentAttempt] = useState(0);

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const next = new Viewer(hostRef.current);
      setViewer(next);
      return () => { next.dispose(); };
    } catch {
      setError("The 3D viewer could not start. Check that WebGL is enabled in your browser.");
    }
  }, []);

  useEffect(() => {
    if (!viewer) return;
    let stale = false;
    setLoaded(null);
    setError(null);
    viewer.load(modelUrl, { orbit, target, fov })
      .then((model) => { if (!stale && model) setLoaded({ ...model, url: modelUrl }); })
      .catch(() => { if (!stale) setError("This model could not be loaded."); });
    return () => { stale = true; viewer.cancelLoad(); };
  }, [viewer, modelUrl, orbit, target, fov, attempt]);

  useEffect(() => {
    if (loaded?.url === modelUrl) viewer?.setAnimation(animationName, animationPaused, timeScale, playFirstClip);
  }, [viewer, loaded, modelUrl, animationName, playFirstClip, animationPaused, timeScale]);

  useEffect(() => {
    if (!viewer || !poseRuntime) return;
    const rig = viewer.setPoseRuntime(poseRuntime);
    setLoaded((previous) => previous && previous.rig !== rig ? { ...previous, rig } : previous);
  }, [viewer, poseRuntime, loaded?.scene]);

  useEffect(() => { viewer?.setPoseMode(poseMode); }, [viewer, poseMode, loaded]);
  useEffect(() => { viewer?.setExposure(exposure); }, [viewer, exposure]);
  useEffect(() => {
    if (!viewer) return;
    let stale = false;
    setEnvironmentError(null);
    viewer.setEnvironment(environmentImageUrl).catch(() => {
      if (!stale) setEnvironmentError("The environment could not be loaded.");
    });
    return () => { stale = true; };
  }, [viewer, environmentImageUrl, environmentAttempt]);
  useEffect(() => { viewer?.setBackgroundVisible(showEnvironment); }, [viewer, showEnvironment]);

  const ready = viewer && loaded?.url === modelUrl;
  // Controls outside the view, like Save image, get the viewer only while a
  // model is shown.
  const shown = ready ? viewer : null;
  useEffect(() => {
    shareViewer(shown);
    return () => shareViewer(null);
  }, [shown, shareViewer]);

  return (
    <div className="ModelViewer">
      <div className="ModelViewerCanvas" ref={hostRef} />
      {error ? (
        <div className="ModelViewerStatus" role="alert">
          {error}
          {viewer && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}
        </div>
      ) : !ready ? <ModelLoading /> : null}
      {!error && environmentError ? (
        <div className="ModelViewerStatus" role="alert">
          {environmentError}
          <button type="button" onClick={() => setEnvironmentAttempt((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      {ready ? (
        <ModelViewerContext.Provider value={{ viewer, ...loaded }}>
          <Materials />
          <LiveMocapPose />
        </ModelViewerContext.Provider>
      ) : null}
    </div>
  );
}
