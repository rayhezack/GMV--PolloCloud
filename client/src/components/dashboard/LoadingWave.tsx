import { Wave } from 'loading-dev';

export default function LoadingWave({ label }: { label?: string }) {
  return (
    <div className="dashboard-wave-loader">
      <div className="dashboard-wave-loader-motion" aria-hidden="true">
        <Wave size={40} color="var(--series-1)" />
      </div>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
