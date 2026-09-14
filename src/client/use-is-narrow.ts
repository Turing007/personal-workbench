import { useEffect, useState } from 'react';

const NARROW_QUERY = '(max-width: 900px)';

/** 是否窄屏（手机/小平板）：用于只在小屏启用的交互（如字段分组折叠）。 */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (
    typeof window === 'undefined' ? false : window.matchMedia(NARROW_QUERY).matches
  ));

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return narrow;
}
