import { useQueryClient } from "@tanstack/react-query";
import { ReactNode, useMemo } from "react";
import { ImageLoaderContext } from "./useImageLoader";
import { imageUrlToArrayBuffer } from "./imageUtils";

export default function ImageLoaderProvider({
  children,
}: {
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const context = useMemo(() => {
    return {
      async loadImage(imageUrl: string) {
        if (imageUrl.startsWith("data:")) {
          return imageUrlToArrayBuffer(imageUrl);
        } else {
          const arrayBuffer = await queryClient.fetchQuery<ArrayBuffer>({
            queryKey: [imageUrl],
          });
          return arrayBuffer;
        }
      },
    };
  }, [queryClient]);

  return (
    <ImageLoaderContext.Provider value={context}>
      {children}
    </ImageLoaderContext.Provider>
  );
}
