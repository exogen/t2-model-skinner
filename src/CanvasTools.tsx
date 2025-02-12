import { InputHTMLAttributes, useEffect, useRef, useState } from "react";
import { fabric } from "fabric";
import getConfig from "next/config";
import useCanvas from "./useCanvas";
import useTools from "./useTools";
import { usePopper } from "react-popper";
import Slider from "rc-slider";
import { RiFileCopyFill } from "react-icons/ri";
import { HiSparkles } from "react-icons/hi";
import {
  FaTrashAlt,
  FaAngleDown,
  FaLock,
  FaUnlock,
  FaArrowUp,
  FaArrowDown,
} from "react-icons/fa";
import { GiArrowCursor } from "react-icons/gi";
import { IoMdBrush } from "react-icons/io";
import { ImPlus, ImUndo2, ImRedo2, ImContrast } from "react-icons/im";
import useWarrior from "./useWarrior";
import { MaterialDefinition } from "./Material";

const { publicRuntimeConfig } = getConfig();
const { materials } = publicRuntimeConfig;

export default function CanvasTools() {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportFileType, setExportFileType] = useState("vl2");
  const {
    activeCanvas,
    backgroundColor,
    setBackgroundColor,
    selectedObjects,
    lockedObjects,
    lockSelection,
    unlockSelection,
    bringForward,
    sendBackward,
    duplicate,
    deleteSelection,
    undo,
    redo,
    canUndo,
    canRedo,
    copyToMetallic,
    brushColor,
    setBrushColor,
    brushSize,
    setBrushSize,
    hueRotate,
    setHueRotate,
    saturation,
    setSaturation,
    brightness,
    setBrightness,
    contrast,
    setContrast,
    layerMode,
    setLayerMode,
    activeCanvasType,
    addImages,
    exportSkin,
    selectedExportMaterials,
    setSelectedExportMaterials,
  } = useTools();
  const { actualModel } = useWarrior();
  const materialDefs: MaterialDefinition[] = materials[actualModel];
  const { canvas, isDrawingMode, setDrawingMode } = useCanvas(activeCanvas);
  const [isMac, setIsMac] = useState(false);
  const commandKeyPrefix = isMac ? "⌘" : "Ctrl ";
  const shiftKeySymbol = "⇧";

  // Brush popup
  const [referenceElement, setReferenceElement] = useState<HTMLElement | null>(
    null
  );
  const [popperElement, setPopperElement] = useState<HTMLElement | null>(null);
  const [isBrushToolsOpen, setBrushToolsOpen] = useState(false);
  const [isFilterToolsOpen, setFilterToolsOpen] = useState(false);
  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    modifiers: [
      {
        name: "offset",
        options: {
          offset: [0, 10],
        },
      },
    ],
  });

  // Export popup
  const [isExportOptionsOpen, setExportOptionsOpen] = useState(false);
  const [exportReferenceElement, setExportReferenceElement] =
    useState<HTMLElement | null>(null);
  const { styles: exportStyles, attributes: exportAttributes } = usePopper(
    exportReferenceElement,
    popperElement,
    {
      modifiers: [
        {
          name: "offset",
          options: {
            offset: [0, 10],
          },
        },
      ],
    }
  );

  const isSelectionLocked = selectedObjects.length
    ? selectedObjects.every((object) => lockedObjects.has(object))
    : false;

  const hasSelection = selectedObjects.length > 0;

  const selectionHasImages =
    selectedObjects.filter((object) => object instanceof fabric.Image).length >
    0;

  const handleBackgroundColorChange: InputHTMLAttributes<HTMLInputElement>["onChange"] =
    (event) => {
      setBackgroundColor(event.target.value);
    };

  useEffect(() => {
    if (navigator.platform && navigator.platform.startsWith("Mac")) {
      setIsMac(true);
    } else if (navigator.userAgent.match(/\(Macintosh;/)) {
      setIsMac(true);
    }
  }, []);

  useEffect(() => {
    if (popperElement) {
      popperElement.focus();
    }
  }, [popperElement]);

  return (
    <div className="CanvasTools">
      <div className="CanvasBackgroundColor">
        <input
          className="ColorSwatch"
          type="radio"
          name="backgroundColor"
          id="canvasBackgroundColorBlack"
          value="black"
          checked={backgroundColor === "black"}
          onChange={handleBackgroundColorChange}
        />
        <label htmlFor="canvasBackgroundColorBlack">
          <span className="HiddenLabel">Black</span>
        </label>
        <input
          className="ColorSwatch"
          type="radio"
          name="backgroundColor"
          id="canvasBackgroundColorMagenta"
          value="magenta"
          checked={backgroundColor === "magenta"}
          onChange={handleBackgroundColorChange}
        />
        <label htmlFor="canvasBackgroundColorMagenta">
          <span className="HiddenLabel">Magenta</span>
        </label>
        <input
          className="ColorSwatch"
          type="radio"
          name="backgroundColor"
          id="canvasBackgroundColorWhite"
          value="white"
          checked={backgroundColor === "white"}
          onChange={handleBackgroundColorChange}
        />
        <label htmlFor="canvasBackgroundColorWhite">
          <span className="HiddenLabel">White</span>
        </label>
      </div>
      <div className="Buttons">
        {activeCanvasType === "metallic" ? (
          <>
            <div className="ButtonGroup">
              <button
                className="ButtonGroup"
                type="button"
                data-active={isDrawingMode ? undefined : ""}
                aria-label="Select Mode"
                title="Select Mode (S)"
                onClick={() => {
                  setDrawingMode(false);
                }}
              >
                <GiArrowCursor />
              </button>
              <button
                className="ButtonGroup"
                type="button"
                ref={setReferenceElement}
                data-active={isDrawingMode ? "" : undefined}
                aria-label="Paint Mode"
                title="Paint Mode (P)"
                onClick={() => {
                  setDrawingMode(true);
                  setBrushToolsOpen((isOpen) => !isOpen);
                }}
              >
                <IoMdBrush />
              </button>
            </div>

            {isBrushToolsOpen ? (
              <div
                className="BrushToolsPopup"
                ref={setPopperElement}
                style={styles.popper}
                tabIndex={-1}
                onBlur={(event) => {
                  const newFocusElement = event.relatedTarget;
                  const isFocusLeaving =
                    !newFocusElement ||
                    !event.currentTarget.contains(newFocusElement);
                  if (isFocusLeaving) {
                    setBrushToolsOpen(false);
                  }
                }}
                {...attributes.popper}
              >
                <div className="Fields">
                  <div className="Field">
                    <label>Metallic Amount</label>
                    <div className="SliderContainer">
                      <Slider
                        min={0}
                        max={255}
                        trackStyle={{
                          display: "none",
                        }}
                        value={brushColor}
                        onChange={(value) => {
                          if (Array.isArray(value)) {
                            value = value[0];
                          }
                          setBrushColor(value);
                        }}
                        handleStyle={{
                          width: 20,
                          height: 20,
                          marginTop: -6,
                          borderColor: "rgb(20, 105, 241)",
                          background: `rgb(${brushColor}, ${brushColor}, ${brushColor})`,
                          opacity: 1,
                        }}
                        railStyle={{
                          height: 8,
                          border: "1px solid #555",
                          background:
                            "linear-gradient(to right, black 0%, white 100%)",
                        }}
                      />
                    </div>
                  </div>

                  <div className="Field">
                    <label>Brush Size</label>
                    <div className="SliderContainer">
                      <Slider
                        min={1}
                        max={50}
                        trackStyle={{
                          height: 8,
                          background: "#03fccf",
                        }}
                        value={brushSize}
                        onChange={(value) => {
                          if (Array.isArray(value)) {
                            value = value[0];
                          }
                          setBrushSize(value);
                        }}
                        handleStyle={{
                          width: 20,
                          height: 20,
                          marginTop: -6,
                          borderColor: "#03fccf",
                          background: "rgb(5, 69, 76)",
                          // background: `rgb(${brushColor}, ${brushColor}, ${brushColor})`,
                          opacity: 1,
                        }}
                        railStyle={{
                          height: 8,
                          border: "1px solid #555",
                          background: "rgba(255, 255, 255, 0.3)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        <>
          <input
            ref={fileInputRef}
            onChange={async (event) => {
              const imageUrl = await new Promise<string>((resolve, reject) => {
                const inputFile = event.target.files?.[0];
                if (inputFile) {
                  const reader = new FileReader();
                  reader.addEventListener("load", (event) => {
                    resolve(event.target?.result as string);
                  });
                  reader.readAsDataURL(inputFile);
                } else {
                  reject(new Error("No input file provided."));
                }
              });
              addImages([imageUrl]);
            }}
            type="file"
            accept=".png, image/png"
            hidden
          />
          <button
            type="button"
            aria-label="Add Image"
            title="Add Image"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
          >
            <ImPlus style={{ fontSize: 14 }} />
          </button>

          <button
            type="button"
            ref={setReferenceElement}
            data-active={isFilterToolsOpen ? "" : undefined}
            aria-label="Filters"
            title="Filters"
            disabled={hasSelection && !selectionHasImages}
            onClick={() => {
              setFilterToolsOpen((isOpen) => !isOpen);
            }}
          >
            <ImContrast />
          </button>

          {isFilterToolsOpen ? (
            <div
              className="BrushToolsPopup"
              ref={setPopperElement}
              style={styles.popper}
              tabIndex={-1}
              onBlur={(event) => {
                const newFocusElement = event.relatedTarget;
                const isFocusLeaving =
                  !newFocusElement ||
                  !event.currentTarget.contains(newFocusElement);
                if (isFocusLeaving) {
                  setFilterToolsOpen(false);
                }
              }}
              {...attributes.popper}
            >
              <div className="Fields">
                <div className="Field ApplyTo">
                  <label>Layer:</label>
                  <ul>
                    {selectedObjects.length ? (
                      <li>
                        <input
                          type="radio"
                          name="FilterLayer"
                          value="SelectedLayer"
                          id="FilterLayer-SelectedLayer"
                          checked={layerMode === "SelectedLayer"}
                          onChange={() => {
                            setLayerMode("SelectedLayer");
                          }}
                        />
                        <label htmlFor="FilterLayer-SelectedLayer">
                          selected ({selectedObjects.length.toLocaleString()})
                        </label>
                      </li>
                    ) : (
                      <>
                        <li>
                          <input
                            type="radio"
                            name="FilterLayer"
                            value="BaseLayer"
                            id="FilterLayer-BaseLayer"
                            checked={layerMode === "BaseLayer"}
                            onChange={() => {
                              setLayerMode("BaseLayer");
                            }}
                          />{" "}
                          <label htmlFor="FilterLayer-BaseLayer">base</label>
                        </li>
                        <li>
                          <input
                            type="radio"
                            name="FilterLayer"
                            value="AllLayers"
                            id="FilterLayer-AllLayers"
                            checked={layerMode === "AllLayers"}
                            onChange={() => {
                              setLayerMode("AllLayers");
                            }}
                          />
                          <label htmlFor="FilterLayer-AllLayers">
                            all (
                            {canvas?._objects
                              .filter(
                                (object) => object instanceof fabric.Image
                              )
                              .length.toLocaleString() ?? 0}
                            )
                          </label>
                        </li>
                      </>
                    )}
                  </ul>
                </div>
                {activeCanvasType === "color" ? (
                  <>
                    <div className="Field">
                      <label>
                        Hue:{" "}
                        <strong>
                          {hueRotate == null ? (
                            "MULTIPLE VALUES"
                          ) : (
                            <>{Math.round(hueRotate * 180)}&deg;</>
                          )}
                        </strong>
                      </label>
                      <div className="SliderContainer">
                        <Slider
                          min={-180}
                          max={180}
                          startPoint={0}
                          value={Math.round((hueRotate ?? 0) * 180)}
                          onChange={(value) => {
                            if (Array.isArray(value)) {
                              value = value[0];
                            }
                            setHueRotate(value / 180);
                          }}
                          trackStyle={{
                            height: 8,
                            background: "#03fccf",
                          }}
                          handleStyle={{
                            width: 20,
                            height: 20,
                            marginTop: -6,
                            borderColor: "#03fccf",
                            background: "rgb(5, 69, 76)",
                            // background: `rgb(${brushColor}, ${brushColor}, ${brushColor})`,
                            opacity: 1,
                          }}
                          railStyle={{
                            height: 8,
                            border: "1px solid #555",
                            background: "rgba(255, 255, 255, 0.3)",
                          }}
                        />
                      </div>
                    </div>

                    <div className="Field">
                      <label>
                        Saturation:{" "}
                        <strong>
                          {saturation == null
                            ? "MULTIPLE VALUES"
                            : `${Math.round(saturation * 100 + 100)}%`}
                        </strong>
                      </label>
                      <div className="SliderContainer">
                        <Slider
                          min={-100}
                          max={100}
                          startPoint={0}
                          value={Math.round((saturation ?? 0) * 100)}
                          onChange={(value) => {
                            if (Array.isArray(value)) {
                              value = value[0];
                            }
                            setSaturation(value / 100);
                          }}
                          trackStyle={{
                            height: 8,
                            background: "#03fccf",
                          }}
                          handleStyle={{
                            width: 20,
                            height: 20,
                            marginTop: -6,
                            borderColor: "#03fccf",
                            background: "rgb(5, 69, 76)",
                            // background: `rgb(${brushColor}, ${brushColor}, ${brushColor})`,
                            opacity: 1,
                          }}
                          railStyle={{
                            height: 8,
                            border: "1px solid #555",
                            background: "rgba(255, 255, 255, 0.3)",
                          }}
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="Field">
                  <label>
                    Brightness:{" "}
                    <strong>
                      {brightness == null
                        ? "MULTIPLE VALUES"
                        : `${Math.round(brightness * 100 + 100)}%`}
                    </strong>
                  </label>
                  <div className="SliderContainer">
                    <Slider
                      min={-100}
                      max={100}
                      startPoint={0}
                      value={Math.round((brightness ?? 0) * 100)}
                      onChange={(value) => {
                        if (Array.isArray(value)) {
                          value = value[0];
                        }
                        setBrightness(value / 100);
                      }}
                      trackStyle={{
                        height: 8,
                        background: "#03fccf",
                      }}
                      handleStyle={{
                        width: 20,
                        height: 20,
                        marginTop: -6,
                        borderColor: "#03fccf",
                        background: "rgb(5, 69, 76)",
                        // background: `rgb(${brushColor}, ${brushColor}, ${brushColor})`,
                        opacity: 1,
                      }}
                      railStyle={{
                        height: 8,
                        border: "1px solid #555",
                        background: "rgba(255, 255, 255, 0.3)",
                      }}
                    />
                  </div>
                </div>

                <div className="Field">
                  <label>
                    Contrast:{" "}
                    <strong>
                      {contrast == null
                        ? "MULTIPLE VALUES"
                        : `${Math.round(contrast * 100 + 100)}%`}
                    </strong>
                  </label>
                  <div className="SliderContainer">
                    <Slider
                      min={-100}
                      max={100}
                      startPoint={0}
                      value={Math.round((contrast ?? 0) * 100)}
                      onChange={(value) => {
                        if (Array.isArray(value)) {
                          value = value[0];
                        }
                        setContrast(value / 100);
                      }}
                      trackStyle={{
                        height: 8,
                        background: "#03fccf",
                      }}
                      handleStyle={{
                        width: 20,
                        height: 20,
                        marginTop: -6,
                        borderColor: "#03fccf",
                        background: "rgb(5, 69, 76)",
                        // background: `rgb(${brushColor}, ${brushColor}, ${brushColor})`,
                        opacity: 1,
                      }}
                      railStyle={{
                        height: 8,
                        border: "1px solid #555",
                        background: "rgba(255, 255, 255, 0.3)",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            aria-label={isSelectionLocked ? "Unlock" : "Lock"}
            title={isSelectionLocked ? "Unlock (L)" : "Lock (L)"}
            onClick={isSelectionLocked ? unlockSelection : lockSelection}
            data-locked={isSelectionLocked ? "" : undefined}
            disabled={!hasSelection}
          >
            {isSelectionLocked ? (
              <FaUnlock style={{ fontSize: 14 }} />
            ) : (
              <FaLock style={{ fontSize: 14 }} />
            )}
          </button>
          <div className="ButtonGroup">
            <button
              type="button"
              aria-label="Bring Forward"
              title="Bring Forward (F)"
              onClick={bringForward}
              disabled={!hasSelection}
            >
              <FaArrowUp />
            </button>
            <button
              type="button"
              aria-label="Send Backward"
              title="Send Backward (B)"
              onClick={sendBackward}
              disabled={!hasSelection}
            >
              <FaArrowDown />
            </button>
          </div>
          <button
            type="button"
            aria-label="Duplicate"
            title="Duplicate (D)"
            onClick={duplicate}
            disabled={!hasSelection}
          >
            <RiFileCopyFill />
          </button>
          <button
            type="button"
            aria-label="Delete"
            title="Delete (Backspace)"
            onClick={deleteSelection}
            disabled={isSelectionLocked || !hasSelection}
          >
            <FaTrashAlt />
          </button>
          <div className="ButtonGroup">
            <button
              type="button"
              aria-label="Undo"
              title={`Undo (${commandKeyPrefix}Z)`}
              onClick={undo}
              disabled={!canUndo}
            >
              <ImUndo2 />
            </button>
            <button
              type="button"
              aria-label="Redo"
              title={`Redo (${
                isMac
                  ? `${shiftKeySymbol}${commandKeyPrefix}Z)`
                  : `${commandKeyPrefix} Y`
              })`}
              onClick={redo}
              disabled={!canRedo}
            >
              <ImRedo2 />
            </button>
          </div>
          {activeCanvasType === "color" ? (
            <button
              type="button"
              className="MetallicButton"
              aria-label="Copy to Metallic"
              title="Copy to Metallic"
              onClick={copyToMetallic}
            >
              <HiSparkles /> <span className="ButtonLabel">Metal</span>
            </button>
          ) : null}
        </>
      </div>
      <div className="Export">
        <input
          ref={nameInputRef}
          type="text"
          name="CustomSkinName"
          placeholder="Skin Name"
          size={12}
        />
        <button
          className="ExportOptionsButton"
          type="button"
          ref={setExportReferenceElement}
          data-active={isExportOptionsOpen ? "" : undefined}
          aria-label="Export Options"
          title="Export Options"
          onClick={() => {
            setExportOptionsOpen((isOpen) => !isOpen);
          }}
        >
          .{exportFileType}
          <FaAngleDown />
        </button>

        {isExportOptionsOpen ? (
          <div
            className="ExportOptionsPopup"
            ref={setPopperElement}
            style={exportStyles.popper}
            tabIndex={-1}
            onBlur={(event) => {
              const newFocusElement = event.relatedTarget;
              const isFocusLeaving =
                !newFocusElement ||
                !event.currentTarget.contains(newFocusElement);
              if (isFocusLeaving) {
                setExportOptionsOpen(false);
              }
            }}
            {...exportAttributes.popper}
          >
            <div className="Fields">
              <div className="Field">
                <label>Export Materials</label>
                <ul className="ExportOptionsList">
                  {materialDefs.map((material, i) => {
                    if (
                      material &&
                      material.selectable !== false &&
                      !material.hidden
                    ) {
                      return (
                        <li key={material.name}>
                          <input
                            id={`MaterialSelect-${material.name}`}
                            type="checkbox"
                            checked={selectedExportMaterials[i] !== false}
                            onChange={(event) => {
                              setSelectedExportMaterials(
                                (selectedExportMaterials) => {
                                  const newSelectedExportMaterials =
                                    selectedExportMaterials.slice();
                                  newSelectedExportMaterials[i] =
                                    event.target.checked;
                                  return newSelectedExportMaterials;
                                }
                              );
                            }}
                          />
                          <label htmlFor={`MaterialSelect-${material.name}`}>
                            {material.label}
                          </label>
                        </li>
                      );
                    } else {
                      return null;
                    }
                  })}
                </ul>
              </div>

              <div className="Field">
                <label htmlFor="ExportFormat">Export Format</label>
                <select
                  id="ExportFormat"
                  value={exportFileType}
                  onChange={(event) => {
                    setExportFileType(event.target.value);
                  }}
                >
                  <option value="png">.png</option>
                  <option value="vl2">.vl2</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            const name = nameInputRef.current ? nameInputRef.current.value : "";
            exportSkin({ name, format: exportFileType });
          }}
        >
          Export
        </button>
      </div>
    </div>
  );
}
