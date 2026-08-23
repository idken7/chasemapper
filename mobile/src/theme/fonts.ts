import {
  useFonts as useSpaceGrotesk,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  useFonts as useIbmPlexMono,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';

export function useAppFonts(): [boolean, Error | null] {
  const [spaceGroteskLoaded, spaceGroteskError] = useSpaceGrotesk({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const [ibmPlexMonoLoaded, ibmPlexMonoError] = useIbmPlexMono({
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  const loaded = spaceGroteskLoaded && ibmPlexMonoLoaded;
  const error = spaceGroteskError ?? ibmPlexMonoError ?? null;
  return [loaded, error];
}
