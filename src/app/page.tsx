"use client";
import dynamic from "next/dynamic";
import EditorProvider from "../EditorProvider";
import EditorWorkspace from "../EditorWorkspace";
import ImageWorkerProvider from "../ImageWorkerProvider";
import WarriorProvider from "../WarriorProvider";
import EnvironmentSelector from "../EnvironmentSelector";
import EnvironmentExposure from "../EnvironmentExposure";
import AnimationSelector from "../AnimationSelector";
import EnvironmentProvider from "../EnvironmentProvider";
import MocapProvider, { LiveMocapControls } from "../MocapProvider";
import SaveModelImage from "../SaveModelImage";
import ViewerProvider from "../ViewerProvider";
import SkinProvider from "../SkinProvider";
import ImageLoaderProvider from "../ImageLoaderProvider";
import {
  QueryClient,
  QueryClientProvider,
  QueryKey,
} from "@tanstack/react-query";
import { imageUrlToArrayBuffer } from "../imageUtils";
import { Suspense } from "react";

// The 3D view's code loads after the page. Until then the same box holds its
// place, so nothing below it jumps when it arrives.
const WarriorViewer = dynamic(() => import("../WarriorViewer"), {
  ssr: false,
  loading: () => (
    <div className="ModelViewer">
      <div className="ModelViewerStatus" role="status">Loading model…</div>
    </div>
  ),
});

async function imageFetcher({ queryKey }: { queryKey: QueryKey }) {
  const [imageUrl] = queryKey as [string];
  return imageUrlToArrayBuffer(imageUrl);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: imageFetcher,
      staleTime: Infinity,
      gcTime: 60000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

export default function HomePage() {
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <main>
          <ImageLoaderProvider>
            <Suspense>
              <WarriorProvider>
                <EnvironmentProvider>
                  <ImageWorkerProvider>
                    <SkinProvider>
                      <MocapProvider>
                        <ViewerProvider>
                          <div className="Viewport">
                            <div className="ModelTools">
                              <div className="Field EnvironmentField">
                                <EnvironmentSelector />
                              </div>
                              <div className="Field SliderField">
                                <EnvironmentExposure />
                              </div>
                              <div className="AnimationTools">
                                <SaveModelImage />
                                <LiveMocapControls />
                                <div className="Field AnimationField">
                                  <AnimationSelector />
                                </div>
                              </div>
                            </div>
                            <WarriorViewer />
                          </div>
                        </ViewerProvider>
                        <EditorProvider>
                          <EditorWorkspace />
                        </EditorProvider>
                      </MocapProvider>
                    </SkinProvider>
                  </ImageWorkerProvider>
                </EnvironmentProvider>
              </WarriorProvider>
            </Suspense>
          </ImageLoaderProvider>
        </main>
      </QueryClientProvider>
    </>
  );
}
