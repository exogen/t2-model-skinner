import { CgSpinnerTwo } from "react-icons/cg";

export default function ModelLoading() {
  return (
    <div className="ModelLoading" role="status" aria-label="Loading model">
      <CgSpinnerTwo aria-hidden="true" />
    </div>
  );
}
