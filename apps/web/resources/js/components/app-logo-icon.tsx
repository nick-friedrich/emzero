import type { ImgHTMLAttributes } from 'react';

export default function AppLogoIcon(
    props: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>,
) {
    return (
        <img
            {...props}
            src="/brand/emzero-logo-header.webp"
            alt=""
            width={192}
            height={192}
        />
    );
}
