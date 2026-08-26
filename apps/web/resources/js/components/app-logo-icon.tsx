import type { ImgHTMLAttributes } from 'react';

export default function AppLogoIcon(
    props: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>,
) {
    return (
        <img
            {...props}
            src="/brand/emzero-logo.png"
            alt=""
            width={1254}
            height={1254}
        />
    );
}
