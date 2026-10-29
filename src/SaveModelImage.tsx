import { useRef } from "react";
import { saveAs } from "file-saver";
import { ImFilePicture } from "react-icons/im";
import { exportModelImage, imageFileName, skinLabel } from "./modelImage";
import { useMocap } from "./MocapProvider";
import useMessageDialog from "./useMessageDialog";
import useViewer from "./useViewer";
import useWarrior from "./useWarrior";
import styles from "./SaveModelImage.module.css";

/** Saves the model as the 3D view draws it, with a transparent background:
 * whatever pose is showing, whether live, played back or animated. */
export default function SaveModelImage() {
  const { viewer } = useViewer();
  const { selectedSkin, selectedSkinType, selectedModel, selectedModelType } =
    useWarrior();
  const { tracking } = useMocap();
  const { showMessage, messageDialog } = useMessageDialog();
  const saving = useRef(false);
  // Names the recording or pose being played back, like "Pose 2".
  const subject = tracking?.recorder.selected?.label ?? null;

  const save = async () => {
    if (!viewer || saving.current) return;
    saving.current = true;
    const skin = skinLabel(selectedModelType, selectedSkinType, selectedSkin);
    const fileName = imageFileName(skin, selectedModel, subject, new Date());
    try {
      saveAs(await exportModelImage(viewer), fileName);
    } catch (error) {
      showMessage(
        error instanceof Error &&
          error.message ===
            "The model is out of view, so there is nothing to save."
          ? error.message
          : "The image could not be saved. Try again.",
        "Unable to save image",
      );
    } finally {
      saving.current = false;
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.Button}
        aria-label="Save image"
        title="Save image"
        disabled={!viewer}
        onClick={() => void save()}
      >
        <ImFilePicture aria-hidden="true" />
        <span className="ButtonText">Save image</span>
      </button>
      {messageDialog}
    </>
  );
}
