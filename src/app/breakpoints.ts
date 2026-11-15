/** The phone layout (one pane, Calculate / Graph switch): a narrow window, or a phone on its side. The app and the stylesheets share these, where CSS writes (--phone) and (--desktop) (see vite.config.ts). */
export const PHONE_QUERY = '(max-width: 760px), (max-height: 460px) and (pointer: coarse)';
export const DESKTOP_QUERY = '(min-width: 761px) and (min-height: 461px), (min-width: 761px) and (pointer: fine)';
