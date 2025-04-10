import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useCallback, useEffect, useRef, useState } from 'react';

// WebSocket endpoint for our Fly.io backend
const FLY_BACKEND_URL = 'https://create-fly-backend.fly.dev';
const WS_ENDPOINT = `wss://create-fly-backend.fly.dev/ws`;

export async function loader({ params }: LoaderFunctionArgs) {
  const previewId = params.id;

  if (!previewId) {
    throw new Response('Preview ID is required', { status: 400 });
  }

  return json({ previewId });
}

export default function WebContainerPreview() {
  const { previewId } = useLoaderData<typeof loader>();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wsRef = useRef<WebSocket>();
  const [previewUrl, setPreviewUrl] = useState('');

  // Handle preview refresh
  const handleRefresh = useCallback(() => {
    if (iframeRef.current && previewUrl) {
      // Force a clean reload
      iframeRef.current.src = '';
      requestAnimationFrame(() => {
        if (iframeRef.current) {
          iframeRef.current.src = previewUrl;
        }
      });
    }
  }, [previewUrl]);

  // Notify server that this preview is ready
  const notifyPreviewReady = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && previewUrl) {
      wsRef.current.send(JSON.stringify({
        type: 'preview-ready',
        previewId,
        url: previewUrl,
        timestamp: Date.now(),
      }));
    }
  }, [previewId, previewUrl]);

  useEffect(() => {
    // Construct the Fly.io preview URL
    const url = `${FLY_BACKEND_URL}/preview/${previewId}`;
    setPreviewUrl(url);

    // Set the iframe src
    if (iframeRef.current) {
      iframeRef.current.src = url;
    }

    // Initialize WebSocket connection
    const ws = new WebSocket(`${WS_ENDPOINT}?previewId=${previewId}`);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      // Notify server this preview is ready
      notifyPreviewReady();
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.previewId === previewId) {
          if (data.type === 'refresh-preview' || data.type === 'file-change') {
            handleRefresh();
          }
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    // Cleanup
    return () => {
      ws.close();
    };
  }, [previewId, handleRefresh, notifyPreviewReady]);

  return (
    <div className="w-full h-full">
      <iframe
        ref={iframeRef}
        title="Preview"
        className="w-full h-full border-none"
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin"
        allow="cross-origin-isolated"
        loading="eager"
        onLoad={notifyPreviewReady}
      />
    </div>
  );
}
