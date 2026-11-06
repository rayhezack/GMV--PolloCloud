import { Wave } from 'loading-dev';

export default function LoadingWave({ label }: { label?: string }) {
  return (
    <div className="dashboard-wave-loader">
      <div className="dashboard-wave-loader-motion" aria-hidden="true">
        <Wave size={40} color="#5B3FF2" />
      </div>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
