export function BudgetIntelligenceIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M14.5 8.75H11.25C10.2835 8.75 9.5 9.5335 9.5 10.5C9.5 11.4665 10.2835 12.25 11.25 12.25H12.75C13.7165 12.25 14.5 13.0335 14.5 14C14.5 14.9665 13.7165 15.75 12.75 15.75H9.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 7.5V8.75M12 15.75V17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
