import { fabric } from "fabric";

const { BaseFilter } = fabric.Image.filters;

const MaskFilter = fabric.util.createClass(BaseFilter, {
  type: "MaskFilter",
  initialize(options: { mask?: fabric.Image; channel: number }) {
    this.mask = options.mask || null;
    this.channel =
      [0, 1, 2, 3].indexOf(options.channel) > -1 ? options.channel : 0;
  },
  applyTo2d(options: {
    sourceWidth: number;
    sourceHeight: number;
    imageData: { data: Uint8Array };
  }) {
    if (!this.mask) {
      return;
    }
    const { sourceWidth: width, sourceHeight: height } = options;
    const { data } = options.imageData;
    const maskImageElement = this.mask.getElement();
    const maskCanvas = fabric.util.createCanvasElement();
    const channel = this.channel;
    maskCanvas.width = maskImageElement.width;
    maskCanvas.height = maskImageElement.height;
    const ctx = maskCanvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(
      maskImageElement,
      0,
      0,
      maskImageElement.width,
      maskImageElement.height
    );
    const maskImageData = ctx.getImageData(0, 0, width, height);
    const maskData = maskImageData.data;
    const { length } = data;
    for (let i = 0; i < length; i += 4) {
      data[i + 3] = maskData[i + channel];
    }
  },
});

MaskFilter.fromObject = (object: fabric.Object) => new MaskFilter(object);
// fabric.Image.filters.MaskFilter = MaskFilter;

export default MaskFilter;
