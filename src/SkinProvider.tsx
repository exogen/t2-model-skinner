import { ReactNode, useMemo, useState } from "react";
import { SkinContext, MaterialSkins, SkinImages } from "./useSkin";

export default function SkinProvider({ children }: { children: ReactNode }) {
  const [materialSkins, setMaterialSkins] = useState<MaterialSkins>({});

  const setters = useMemo(
    () => ({
      setSkinImages(materialFile: string, skinImages: SkinImages) {
        setMaterialSkins((materialSkins) => {
          return {
            ...materialSkins,
            [materialFile]: skinImages,
          };
        });
      },
      setColorImageUrl(
        materialFile: string,
        colorImageUrl: string,
        frameIndex: number
      ) {
        setMaterialSkins((materialSkins) => {
          const newColorImageUrl = Array.from(
            materialSkins[materialFile]?.colorImageUrl ?? []
          );
          newColorImageUrl[frameIndex] = colorImageUrl;
          return {
            ...materialSkins,
            [materialFile]: {
              ...materialSkins[materialFile],
              colorImageUrl: newColorImageUrl,
            },
          };
        });
      },
      setMetallicImageUrl(
        materialFile: string,
        metallicImageUrl: string,
        frameIndex: number
      ) {
        setMaterialSkins((materialSkins) => {
          const newMetallicImageUrl = Array.from(
            materialSkins[materialFile]?.metallicImageUrl ?? []
          );
          newMetallicImageUrl[frameIndex] = metallicImageUrl;
          return {
            ...materialSkins,
            [materialFile]: {
              ...materialSkins[materialFile],
              metallicImageUrl: newMetallicImageUrl,
            },
          };
        });
      },
    }),
    []
  );

  const context = useMemo(() => {
    return {
      materialSkins,
      getSkinImages(materialFile: string) {
        return materialSkins[materialFile];
      },
      getColorImageUrl(materialFile: string, frameIndex: number) {
        return materialSkins[materialFile].colorImageUrl?.[frameIndex];
      },
      getMetallicImageUrl(materialFile: string, frameIndex: number) {
        return materialSkins[materialFile].metallicImageUrl?.[frameIndex];
      },
      ...setters,
    };
  }, [materialSkins, setters]);

  return (
    <SkinContext.Provider value={context}>{children}</SkinContext.Provider>
  );
}
