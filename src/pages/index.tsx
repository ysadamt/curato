import { specialGothicExpandedOne, switzer } from '@/utils/fonts';
import { getContrastTextColor, getDominantColor } from '@/utils/helpers';
import { Button, Input } from '@headlessui/react';
import { useEffect, useRef, useState } from 'react';
import { TbArrowUpRight, TbLoader2, TbSparkles, TbStopwatch } from 'react-icons/tb';

interface ArtworkNode {
  internalID: string;
  title: string | null;
  slug: string;
  date: string | null;
  medium: string | null;
  artists: { name: string | null; slug: string | null }[] | null;
  image: {
    url: string | null;
    aspectRatio: number;
  } | null;
}

interface ArtworkEdge {
  node: ArtworkNode;
}

interface ArtsyApiResponse {
  artworksConnection?: {
    edges: ArtworkEdge[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    }
  } | null;
  error?: string;
}


export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArtworkEdge[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFirstSearch, setIsFirstSearch] = useState(true);
  const [isOnCooldown, setIsOnCooldown] = useState(false); // State for cooldown status
  const [cooldownTime, setCooldownTime] = useState(0); // State for remaining cooldown time
  const cooldownIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref to store interval ID

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading || isOnCooldown || !query.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults([]); // Clear previous results

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      const data: ArtsyApiResponse = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      if (data.artworksConnection?.edges) {
        setResults(data.artworksConnection.edges);
      } else {
        setResults([]);
        console.log("No artwork edges found in response:", data);
      }

    } catch (err: any) {
      console.error("Failed to fetch artworks:", err);
      setError(err.message || 'Failed to fetch results.');
    } finally {
      setIsLoading(false);
      setIsFirstSearch(false);
      startCooldown();
    }
  };

  const startCooldown = () => {
    setIsOnCooldown(true);
    setCooldownTime(3); // Set cooldown duration to 5 seconds

    // Clear any existing interval before starting a new one
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }

    cooldownIntervalRef.current = setInterval(() => {
      setCooldownTime((prevTime) => {
        if (prevTime <= 1) {
          // When time reaches 0, clear interval and reset cooldown state
          clearInterval(cooldownIntervalRef.current as NodeJS.Timeout);
          cooldownIntervalRef.current = null;
          setIsOnCooldown(false);
          return 0;
        }
        // Decrement time
        return prevTime - 1;
      });
    }, 1000); // Update every second
  };

  useEffect(() => {
    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    async function getArtworkButtonColors() {
      if (results.length > 0) {
        const colors = await Promise.all(results.map((result) => getDominantColor(result.node.image?.url || '')));

        const artworkButtons = document.querySelectorAll('.artsy-button');
        artworkButtons.forEach((artworkButton, index) => {
          (artworkButton as HTMLAnchorElement).style.backgroundColor = colors[index];
          (artworkButton as HTMLAnchorElement).style.color = getContrastTextColor(colors[index]);
        });
      }
    }

    getArtworkButtonColors();
  }, [results]);

  return (
    <main className={`${switzer.className} min-h-dvh flex flex-col items-center ${isFirstSearch ? 'justify-center' : 'justify-start'}`}>
      <div className={`flex flex-col items-center p-6 gap-8 max-w-[1024px]`}>
        <div className="flex flex-col border-4 -rotate-1 p-5 sm:min-w-lg lg:min-w-xl max-w-2xl gap-6 bg-blue-200">
          <h1 className={`${specialGothicExpandedOne.className} uppercase text-4xl sm:text-5xl lg:text-6xl`}>Curato</h1>
          <h2 className="text-sm sm:text-lg lg:text-xl -mt-4 font-bold">Smarter Way to Discover Art.</h2>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row max-sm:items-center gap-4">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe the art you are looking for..."
              disabled={isLoading}
              className="border-4 p-2 sm:p-3 w-full max-w-md font-medium text-sm sm:text-base bg-white"
            />
            <Button
              type="submit"
              disabled={isLoading || isOnCooldown} // Disable button during loading or cooldown
              className={`rotate-2 flex items-center justify-center cursor-pointer bg-blue-500 hover:bg-blue-600 border-4 border-black p-2 sm:p-3 sm:text-lg font-bold text-white transition-all transform hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-75 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none`}
            >
              {isLoading ? (
                <>
                  Searching...
                  <TbLoader2 className="inline-block ml-2 animate-spin" size={24} />
                </>
              ) : isOnCooldown ? (
                <>
                  {cooldownTime}s
                  <TbStopwatch className="inline-block ml-2" size={24} />
                </>
              ) : (
                <>
                  Search
                  <TbSparkles className="inline-block ml-2" size={24} />
                </>
              )}
            </Button>
          </form>
        </div>

        {error && <p style={{ color: 'red' }}>Error: {error}</p>}

        {!isFirstSearch &&
          <div className="flex flex-col items-center mt-4 gap-4">
            <h2 className={`${specialGothicExpandedOne.className} uppercase text-2xl md:text-3xl lg:text-4xl`}>Search Results</h2>
            {results.length === 0 && !isLoading && !error && <p>No results found.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mt-4">
              {results.map(({ node }) => (
                <div key={node.internalID} className="border-4 p-4 flex flex-col justify-between gap-2 transition-all transform hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  {node.image?.url && (
                    <img
                      src={node.image.url}
                      alt={node.title || 'Artwork'}
                      style={{ width: 'auto', height: '250px', objectFit: 'contain' }}
                    />
                  )}
                  <div className="flex flex-col">
                    <h3 className={`${specialGothicExpandedOne.className} text-xl md:text-2xl`}>{node.title || 'Untitled'}</h3>
                    <p className="text-base md:text-lg font-semibold">{node.artists?.map(a => a.name).join(', ') || 'Unknown Artist'}</p>
                    <p className="font-medium">{node.date}</p>
                    <p className="text-sm mt-3 italic">{node.medium}</p>
                  </div>
                  <div className="flex w-full justify-end mt-6">
                    <a href={`https://www.artsy.net/artwork/${node.slug}`} target="_blank" rel="noopener noreferrer" className="artsy-button rotate-1 flex w-fit cursor-pointer hover:brightness-95 border-4 border-black p-3 text-md font-bold text-white transition-all transform hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      View on Artsy
                      <TbArrowUpRight className="inline-block ml-2" size={24} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        }
      </div>
    </main >
  );
}