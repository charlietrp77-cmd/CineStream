import { useEffect } from 'react';
import { init, useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation';

let isNavInitialized = false;

export function useSpatialNavInit() {
  useEffect(() => {
    if (!isNavInitialized) {
      init({
        debug: false,
        visualDebug: false,
      });
      isNavInitialized = true;
    }
  }, []);
}

export { useFocusable, setFocus };

