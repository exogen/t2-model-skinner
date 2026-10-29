import { ReactNode, useMemo, useState } from "react";
import { SkinContext, MaterialSkins } from "./useSkin";

export default function SkinProvider({ children }: { children: ReactNode }) {
  const [materialSkins, setMaterialSkins] = useState<MaterialSkins>({});

  const setters = useMemo(
    () => ({
      setColorImageUrl(
        materialFile: string,
        colorImageUrl: string,
        frameIndex: number,
      ) {
        setMaterialSkins((materialSkins) => {
          const newColorImageUrl = Array.from(
            materialSkins[materialFile]?.colorImageUrl ?? [],
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
        frameIndex: number,
      ) {
        setMaterialSkins((materialSkins) => {
          const newMetallicImageUrl = Array.from(
            materialSkins[materialFile]?.metallicImageUrl ?? [],
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
    [],
  );

  const context = useMemo(() => {
    return {
      getSkinImages(materialFile: string) {
        return materialSkins[materialFile];
      },
      ...setters,
    };
  }, [materialSkins, setters]);

  return (
    <SkinContext.Provider value={context}>{children}</SkinContext.Provider>
  );
}
