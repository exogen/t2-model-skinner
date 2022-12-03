import { fabric } from "fabric";

const { BaseFilter } = fabric.Image.filters;

const NoAlphaFilter = fabric.util.createClass(BaseFilter, {
  type: "NoAlphaFilter",
  initialize(options: { rgba: Uint8Array }) {
    this.rgba = options.rgba;
  },
  applyTo2d(options: {
    sourceWidth: number;
    sourceHeight: number;
    imageData: {
      data: Uint8Array;
    };
  }) {
    const { data } = options.imageData;
    const { length } = data;
    for (let i = 0; i < length; i += 4) {
      data[i] = this.rgba[i];
      data[i + 1] = this.rgba[i + 1];
      data[i + 2] = this.rgba[i + 2];
      data[i + 3] = 255;
    }
  },
});

NoAlphaFilter.fromObject = (object: fabric.Object) => new NoAlphaFilter(object);
// fabric.Image.filters.NoAlphaFilter = NoAlphaFilter;

export default NoAlphaFilter;
