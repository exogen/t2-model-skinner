import { FaGithub } from "react-icons/fa";

export default function AppFooter() {
  return (
    <footer className="AppFooter">
      <a href="https://github.com/exogen/t2-model-skinner" className="IconLink">
        <FaGithub size={24} />
      </a>
      <div className="Sponsor">
        <a
          href="https://github.com/sponsors/exogen"
          target="_blank"
          rel="noreferrer"
        >
          Support this project
        </a>{" "}
        <span className="Separator">or</span>{" "}
        <a
          href="https://www.buymeacoffee.com/mosswood"
          target="_blank"
          rel="noreferrer"
        >
          <img
            src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
            alt="Buy Me A Coffee"
            width={109}
            height={31}
          />
        </a>
      </div>
    </footer>
  );
}
