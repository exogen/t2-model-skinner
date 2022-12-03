export default function useSettings() {
  return {
    canvasPadding: 64,
    basePath: process.env.NODE_ENV === "production" ? "/t2-model-skinner" : "",
  };
}
