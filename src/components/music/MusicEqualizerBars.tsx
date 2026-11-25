import React from 'react';

interface MusicEqualizerBarsProps {
  playing?: boolean;
  className?: string;
}

export const MusicEqualizerBars: React.FC<MusicEqualizerBarsProps> = ({
  playing = true,
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-end justify-center gap-[2.5px] h-3.5 w-3.5 ${className}`}
      aria-hidden="true"
    >
      <span
        className={`w-[2.5px] h-full rounded-full bg-gradient-to-t from-purple-400 to-sky-400 ${
          playing ? 'music-eq-bar-1' : 'scale-y-[0.28] origin-bottom transition-transform duration-300'
        }`}
      />
      <span
        className={`w-[2.5px] h-full rounded-full bg-gradient-to-t from-purple-400 to-sky-400 ${
          playing ? 'music-eq-bar-2' : 'scale-y-[0.45] origin-bottom transition-transform duration-300'
        }`}
      />
      <span
        className={`w-[2.5px] h-full rounded-full bg-gradient-to-t from-purple-400 to-sky-400 ${
          playing ? 'music-eq-bar-3' : 'scale-y-[0.25] origin-bottom transition-transform duration-300'
        }`}
      />
    </div>
  );
};

export default MusicEqualizerBars;
