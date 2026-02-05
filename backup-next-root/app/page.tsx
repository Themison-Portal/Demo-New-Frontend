const quickActions = [
  { label: "Create", icon: "pencil" },
  { label: "Source", icon: "book" },
  { label: "Summarize Document", icon: "list" },
  { label: "See More", icon: "plus" }
];

const promptCards = [
  { label: "What happens at Visit 3?", icon: "doc" },
  { label: "Summarize inclusion criteria", icon: "docSearch" },
  { label: "What are the visit windows?", icon: "calendar" },
  { label: "Generate Visit 1 checklist", icon: "checklist" }
];

export default function Home() {
  return (
    <main className="page">
      <section className="hero">
        <div className="input-card">
          <div className="input-placeholder">
            Ask about your protocol, amendments, or trial documents...
          </div>
          <div className="input-controls">
            <div className="left-controls">
              <button className="icon-pill" aria-label="Attach">
                {icon.paperclip}
              </button>
              <button className="pill add-context">
                <span className="pill-icon">{icon.plus}</span>
                Add context
              </button>
            </div>
            <div className="right-controls">
              <button className="pill dropdown">
                <span className="sparkle">{icon.sparkle}</span>
                Auto
                <span className="chev">{icon.chevronDown}</span>
              </button>
              <button className="icon-circle" aria-label="Send">
                {icon.arrowUp}
              </button>
            </div>
          </div>
        </div>

        <div className="action-row">
          {quickActions.map((action) => (
            <button key={action.label} className="pill action-pill">
              <span className="pill-icon">{iconMap[action.icon]}</span>
              {action.label}
            </button>
          ))}
        </div>
      </section>

      <div className="section-title">Explore what you can ask</div>

      <section className="card-grid">
        {promptCards.map((card) => (
          <div key={card.label} className="prompt-card">
            <div className="prompt-icon">{iconMap[card.icon]}</div>
            <div className="prompt-text">{card.label}</div>
          </div>
        ))}
      </section>

      <button className="show-more">
        Show more
        <span className="chev">{icon.chevronDown}</span>
      </button>
    </main>
  );
}

const icon = {
  plus: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  sparkle: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
    </svg>
  ),
  chevronDown: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  arrowUp: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5l6 6M12 5l-6 6" />
      <path d="M12 5v14" />
    </svg>
  ),
  paperclip: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 12.5l6-6a3 3 0 114.2 4.2l-6.9 6.9a5 5 0 01-7.1-7.1l7.3-7.3" />
    </svg>
  )
};

const iconMap: Record<string, JSX.Element> = {
  pencil: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l4.5-1 9-9-3.5-3.5-9 9L4 20z" />
      <path d="M13 5l3.5 3.5" />
    </svg>
  ),
  book: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h9a3 3 0 013 3v11H9a3 3 0 00-3 3V4z" />
      <path d="M6 4v14a3 3 0 013-3h9" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 7h12M6 12h12M6 17h12" />
      <path d="M4 7h.01M4 12h.01M4 17h.01" />
    </svg>
  ),
  plus: icon.plus,
  doc: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7V3z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  docSearch: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v12H6V3z" />
      <path d="M14 3v4h4" />
      <circle cx="15" cy="15" r="3" />
      <path d="M17.5 17.5L20 20" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  ),
  checklist: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7h10M9 12h10M9 17h10" />
      <path d="M4 7l1.5 1.5L7.5 6" />
      <path d="M4 12l1.5 1.5L7.5 11" />
      <path d="M4 17l1.5 1.5L7.5 16" />
    </svg>
  )
};
