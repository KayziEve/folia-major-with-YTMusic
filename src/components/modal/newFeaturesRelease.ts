import { Keyboard, Music2, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// src/components/modal/newFeaturesRelease.ts

type NewFeatureCard = {
    id: string;
    icon: LucideIcon;
    daylightIconClassName: string;
    darkIconClassName: string;
};

type NewFeaturesRelease = {
    i18nKey: string;
    features: NewFeatureCard[];
};

// Defines the current release's cards; their localized text lives under i18nKey in every locale.
export const NEW_FEATURES_RELEASE: NewFeaturesRelease = {
    i18nKey: 'releaseNotes.v0_7_17',
    features: [
        { id: 'ytmusicDesktop', icon: Music2, daylightIconClassName: 'text-red-600', darkIconClassName: 'text-red-400' },
        { id: 'qqAlgorithmPlaylists', icon: Search, daylightIconClassName: 'text-amber-600', darkIconClassName: 'text-amber-400' },
        { id: 'commandPaletteKeyboardScroll', icon: Keyboard, daylightIconClassName: 'text-cyan-600', darkIconClassName: 'text-cyan-400' },
    ],
};
