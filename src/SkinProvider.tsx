import { ReactNode, useMemo, useState } from "react";
import { SkinContext, MaterialSkins, SkinImages } from "./useSkin";

export default function SkinProvider({ children }: { children: ReactNode }) {
  const [materialSkins, setMaterialSkins] = useState<MaterialSkins>({});

  const setters = useMemo(
    () => ({
      setSkinImages(materialName: string, skinImages: SkinImages) {
        setMaterialSkins((materialSkins) => {
          return {
            ...materialSkins,
            [materialName]: skinImages,
          };
        });
      },
      setColorImageUrl(materialName: string, colorImageUrl: string) {
        setMaterialSkins((materialSkins) => {
          return {
            ...materialSkins,
            [materialName]: {
              ...materialSkins[materialName],
              colorImageUrl,
            },
          };
        });
      },
      setMetallicImageUrl(materialName: string, metallicImageUrl: string) {
        setMaterialSkins((materialSkins) => {
          return {
            ...materialSkins,
            [materialName]: {
              ...materialSkins[materialName],
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
      getSkinImages(materialName: string) {
        return materialSkins[materialName];
      },
      getColorImageUrl(materialName: string) {
        return materialSkins[materialName].colorImageUrl;
      },
      getMetallicImageUrl(materialName: string) {
        return materialSkins[materialName].metallicImageUrl;
      },
      ...setters,
    };
  }, [materialSkins, setters]);

  return (
    <SkinContext.Provider value={context}>{children}</SkinContext.Provider>
  );
}
