import dynamic from "next/dynamic";
import getConfig from "next/config";
import useEnvironment from "./useEnvironment";
import useWarrior from "./useWarrior";
import Materials from "./Materials";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });

const { publicRuntimeConfig } = getConfig();

const { cameraOverrides } = publicRuntimeConfig;

export default function WarriorViewer() {
  const {
    selectedModel,
    selectedModelUrl,
    selectedModelType,
    selectedAnimation,
    animationPaused,
  } = useWarrior();
  const { environmentImageUrl, showEnvironment, exposure } = useEnvironment();

  return (
    <ModelViewer
      modelUrl={selectedModelUrl}
      environmentImageUrl={environmentImageUrl}
      showEnvironment={showEnvironment}
      animationName={selectedAnimation}
      animationPaused={animationPaused}
      cameraOrbit={
        selectedModelType === "weapon" ? "315deg 70deg 105%" : undefined
      }
      cameraTarget={cameraOverrides[selectedModel]?.target}
      fieldOfView={cameraOverrides[selectedModel]?.fov}
      exposure={exposure}
    >
      <Materials />
    </ModelViewer>
  );
}
