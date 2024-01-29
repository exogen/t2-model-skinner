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
      setColorImageUrl(materialFile: string, colorImageUrl: string) {
        setMaterialSkins((materialSkins) => {
          return {
            ...materialSkins,
            [materialFile]: {
              ...materialSkins[materialFile],
              colorImageUrl,
            },
          };
        });
      },
      setMetallicImageUrl(materialFile: string, metallicImageUrl: string) {
        setMaterialSkins((materialSkins) => {
          return {
            ...materialSkins,
            [materialFile]: {
              ...materialSkins[materialFile],
              metallicImageUrl,
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
      getColorImageUrl(materialFile: string) {
        return materialSkins[materialFile].colorImageUrl;
      },
      getMetallicImageUrl(materialFile: string) {
        return materialSkins[materialFile].metallicImageUrl;
      },
      ...setters,
    };
  }, [materialSkins, setters]);

  return (
    <SkinContext.Provider value={context}>{children}</SkinContext.Provider>
  );
}
