import { default as RCSlider, SliderProps } from "@rc-component/slider";
import "@rc-component/slider/assets/index.css";

const sliderStyles = {
  track: {
    height: 8,
    background: "#03fccf",
  },
  handle: {
    width: 20,
    height: 20,
    marginTop: -6,
    borderColor: "#03fccf",
    background: "rgb(5, 69, 76)",
    // background: `rgb(${brushColor}, ${brushColor}, ${brushColor})`,
    opacity: 1,
  },
  rail: {
    height: 8,
    border: "1px solid #555",
    background: "rgba(255, 255, 255, 0.3)",
  },
};

export default function Slider(props: SliderProps) {
  return (
    <RCSlider
      {...props}
      styles={{
        ...sliderStyles,
        ...props.styles,
      }}
    />
  );
}
