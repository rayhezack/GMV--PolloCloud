import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  getPollocloudUser,
  type PollocloudUser,
} from '@/lib/pollocloud';

export function usePollocloudUser() {
  const { search } = useLocation();
  const [user, setUser] = useState<PollocloudUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getPollocloudUser().then((nextUser) => {
        if (cancelled) return;
        setUser(nextUser);
        setLoading(false);
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
    };
  }, [search]);

  return { user, loading };
}
