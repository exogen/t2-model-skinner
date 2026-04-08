export default function useSettings() {
  return {
    canvasPadding: 64,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  };
}
