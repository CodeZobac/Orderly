import { Logo } from "./logo";

export function WorkspaceLoader() {
  return (
    <div className="workspace-loader">
      <div className="workspace-loader__brand">
        <Logo />
        <h1>Orderly</h1>
      </div>
      <svg
        className="workspace-loader__scene"
        viewBox="0 0 280 180"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          className="workspace-loader__frame"
          x="16"
          y="12"
          width="248"
          height="156"
          rx="8"
        />
        <path className="workspace-loader__divider" d="M16 42h248M68 42v126" />
        <g className="workspace-loader__chrome">
          <rect x="28" y="23" width="8" height="8" rx="2" />
          <rect x="44" y="25" width="64" height="4" rx="2" />
          <rect x="28" y="58" width="28" height="4" rx="2" />
          <rect x="28" y="72" width="20" height="4" rx="2" />
          <rect x="28" y="86" width="24" height="4" rx="2" />
        </g>
        {[0, 1, 2].map((index) => (
          <g key={index} transform={`translate(82 ${54 + index * 34})`}>
            <g
              className={`workspace-loader__card workspace-loader__card--${index + 1}`}
            >
              <rect
                className="workspace-loader__card-paper"
                width="166"
                height="28"
                rx="4"
              />
              <rect
                className="workspace-loader__check"
                x="9"
                y="9"
                width="10"
                height="10"
                rx="2"
              />
              <path className="workspace-loader__tick" d="m11 14 2 2 4-4" />
              <path className="workspace-loader__line" d="M29 11h74M29 18h48" />
              <circle
                className="workspace-loader__check"
                cx="150"
                cy="14"
                r="4"
              />
            </g>
          </g>
        ))}
      </svg>
      <p role="status">Loading your workspace…</p>
    </div>
  );
}
