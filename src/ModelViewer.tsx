import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import "@google/model-viewer";
import type { ModelViewerElement } from "@google/model-viewer";
import { ModelViewerContext } from "./useModelViewer";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttributes;
    }
    interface ModelViewerAttributes {
      alt: string;
      src: string;
      ref: (modelViewer: ModelViewerElement | null) => void;
      autoplay: "true" | "false";
      scale?: string;
      style: CSSProperties;
    }
  }
}

function useTimeScale(modelViewer: ModelViewerElement | null) {
  useEffect(() => {
    if (modelViewer) {
      modelViewer.timeScale = 0.5;
    }
  }, [modelViewer]);
}

interface ModelViewerProps {
  modelUrl: string;
  environmentImageUrl: string | null;
  colorImageUrl?: string;
  metallicImageUrl?: string;
  animationName: string | null;
  animationPaused?: boolean;
  cameraOrbit?: string;
  cameraTarget?: string;
  fieldOfView?: string;
  children?: ReactNode;
}

function ModelViewerKeyedByModel({
  modelUrl,
  environmentImageUrl,
  animationName,
  animationPaused = false,
  cameraOrbit,
  cameraTarget,
  fieldOfView,
  children,
}: ModelViewerProps) {
  const [modelViewer, setModelViewer] = useState<ModelViewerElement | null>(
    null
  );
  const [isLoaded, setLoaded] = useState(false);

  const context = useMemo(() => {
    if (!modelViewer || !isLoaded || !modelViewer.model) {
      return null;
    }
    return {
      modelViewer,
      model: modelViewer.model,
      isLoaded,
    };
  }, [modelViewer, isLoaded]);

  useTimeScale(modelViewer);

  useEffect(() => {
    if (!modelViewer) {
      return;
    }
    let stale = false;

    const handleLoad = () => {
      if (!stale) {
        setLoaded(true);
      }
    };
    modelViewer.addEventListener("load", handleLoad);

    return () => {
      stale = true;
      modelViewer.removeEventListener("load", handleLoad);
    };
  }, [modelViewer, modelUrl]);

  useEffect(() => {
    if (!modelViewer) {
      return;
    }
    if (modelViewer.loaded) {
      setLoaded(true);
    }
  }, [modelViewer, modelUrl]);

  useEffect(() => {
    if (!modelViewer || !isLoaded) {
      return;
    }
    if (animationPaused) {
      modelViewer.pause();
    } else {
      modelViewer.play();
    }
  }, [modelViewer, isLoaded, animationPaused]);

  useEffect(() => {
    if (modelViewer && isLoaded && fieldOfView) {
      modelViewer.setAttribute("field-of-view", fieldOfView);
    }
  }, [modelViewer, isLoaded, fieldOfView]);

  return (
    <>
      <model-viewer
        ref={setModelViewer}
        alt="Tribes 2 Model"
        src={modelUrl}
        shadow-intensity={0}
        camera-controls
        camera-orbit={cameraOrbit}
        camera-target={cameraTarget}
        min-field-of-view="10deg"
        animation-name={animationName ?? undefined}
        autoplay={animationName ? "true" : "false"}
        touch-action="pan-y"
        environment-image={environmentImageUrl ?? undefined}
        style={{ width: "100%", height: "100%" }}
      />
      {isLoaded ? (
        <ModelViewerContext.Provider value={context}>
          {children}
        </ModelViewerContext.Provider>
      ) : null}
    </>
  );
}

export default function ModelViewer(props: ModelViewerProps) {
  return <ModelViewerKeyedByModel key={props.modelUrl} {...props} />;
}
