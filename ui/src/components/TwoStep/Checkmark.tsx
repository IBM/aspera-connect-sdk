import React from 'react';
import styles from '../../styles/components/TwoStep/Checkmark.module.scss';

interface Props {
  isVisible: boolean;
};

export const Checkmark = ({ isVisible }: Props) => {
  return (
    <span className={isVisible ? styles.visible : styles.hidden}>
        <svg width="18px" height="18px" viewBox="0 0 18 18" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink">
            <defs>
                <circle id="path-1" cx="10" cy="10" r="8.75"></circle>
                <polygon id="path-3" points="8.75 13.4375 5.625 10.3125 6.61875 9.375 8.75 11.46875 13.38125 6.875 14.375 7.8625"></polygon>
            </defs>
            <g id="Extension-Experience" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
                <g id="Welcome-1-Copy-46" transform="translate(-556.000000, -188.000000)">
                    <g id="icon/status/checkmark/filled/20" transform="translate(555.000000, 187.000000)">
                        <mask id="mask-2" fill="white">
                            <use xlinkHref="#path-1"></use>
                        </mask>
                        <use id="icon-color" fill="#24A148" fill-rule="evenodd" xlinkHref="#path-1"></use>
                        <mask id="mask-4" fill="white">
                            <use xlinkHref="#path-3"></use>
                        </mask>
                        <use id="icon-color" fill="#FFFFFF" fill-rule="evenodd" xlinkHref="#path-3"></use>
                    </g>
                </g>
            </g>
        </svg>
    </span>
  );
}
