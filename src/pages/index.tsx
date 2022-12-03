import Head from "next/head";
import CanvasTools from "../CanvasTools";
import ToolsProvider from "../ToolsProvider";
import CanvasBackdrop from "../CanvasBackdrop";
import CanvasProvider from "../CanvasProvider";
import CanvasInteractions from "../CanvasInteractions";
import CanvasToggle from "../CanvasToggle";
import WarriorSelector from "../WarriorSelector";
import WarriorProvider from "../WarriorProvider";
import WarriorViewer from "../WarriorViewer";
import EnvironmentSelector from "../EnvironmentSelector";
import AnimationSelector from "../AnimationSelector";
import EnvironmentProvider from "../EnvironmentProvider";
import SkinProvider from "../SkinProvider";
import MaterialSelector from "../MaterialSelector";
import MaterialCanvases from "../MaterialCanvases";
import ImageLoaderProvider from "../ImageLoaderProvider";
import {
  QueryClient,
  QueryClientProvider,
  QueryKey,
} from "@tanstack/react-query";
import { imageUrlToArrayBuffer } from "../imageUtils";

async function imageFetcher({ queryKey }: { queryKey: QueryKey }) {
  const [imageUrl] = queryKey as [string];
  return imageUrlToArrayBuffer(imageUrl);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: imageFetcher,
      staleTime: Infinity,
      cacheTime: 60000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

export default function HomePage() {
  return (
    <>
      <Head>
        <title>T2 Model Viewer & Skinner</title>
      </Head>
      <QueryClientProvider client={queryClient}>
        <main>
          <ImageLoaderProvider>
            <WarriorProvider>
              <EnvironmentProvider>
                <SkinProvider>
                  <div className="Viewport">
                    <div className="ModelTools">
                      <div className="Field">
                        <EnvironmentSelector />
                      </div>
                      <div className="Field">
                        <AnimationSelector />
                      </div>
                    </div>
                    <WarriorViewer />
                  </div>
                  <CanvasProvider>
                    <ToolsProvider>
                      <CanvasInteractions>
                        <WarriorSelector />
                        <div className="CanvasViewport">
                          <div className="CanvasSelector">
                            <CanvasToggle />
                            <MaterialSelector />
                          </div>
                          <CanvasBackdrop />
                          <MaterialCanvases />
                        </div>
                        <CanvasTools />
                      </CanvasInteractions>
                    </ToolsProvider>
                  </CanvasProvider>
                </SkinProvider>
              </EnvironmentProvider>
            </WarriorProvider>
          </ImageLoaderProvider>
        </main>
      </QueryClientProvider>
    </>
  );
}
