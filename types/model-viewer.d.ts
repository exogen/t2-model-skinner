import "react";
import type { ModelViewerElement } from "@google/model-viewer";

type ModelViewerProps = React.DetailedHTMLProps<
  React.HTMLAttributes<ModelViewerElement>,
  ModelViewerElement
> &
  // avoid the style clash (React owns `style`)
  Omit<Partial<ModelViewerElement>, "style" | "className">;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerProps;
    }
  }
}

export {};
