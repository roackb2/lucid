import { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { wsUrl } from "../common";
import { definitions } from "@/types/apiTypes";

export default function useWebsocket() {
  const [readyStateText, setReadyStateText] = useState<string>('Uninstantiated');
  const [messageHistory, setMessageHistory] = useState<definitions['ws.WsMessage'][]>([]);

  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(wsUrl, {
    onOpen: () => console.log('opened'),
    // Will attempt to reconnect on all close events, such as server shutting down
    shouldReconnect: (closeEvent) => true,
  });

  useEffect(() => {
    if (lastJsonMessage !== null) {
      console.log('lastJsonMessage', lastJsonMessage)
      setMessageHistory((prev) => prev.concat(lastJsonMessage));
    }
  }, [lastJsonMessage]);

  useEffect(() => {
    setReadyStateText({
      [ReadyState.CONNECTING]: 'Connecting',
      [ReadyState.OPEN]: 'Open',
      [ReadyState.CLOSING]: 'Closing',
      [ReadyState.CLOSED]: 'Closed',
      [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
    }[readyState]);
  }, [readyState]);

  return {
    messageHistory,
    readyStateText,
    readyState,
    sendJsonMessage,
  }
}
