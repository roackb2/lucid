import { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { wsUrl } from "../api/common";
import { definitions } from "@/types/apiTypes";

export default function useWebsocket() {
  const [readyStateText, setReadyStateText] = useState<string>('Uninstantiated');
  const [messageHistory, setMessageHistory] = useState<definitions['ws.WsMessage'][]>([]);

  const { sendMessage, lastMessage, readyState } = useWebSocket(wsUrl, {
    onOpen: () => console.log('opened'),
    //Will attempt to reconnect on all close events, such as server shutting down
    shouldReconnect: (closeEvent) => true,
  });

  useEffect(() => {
    if (lastMessage !== null) {
      const parsedMessage = JSON.parse(lastMessage.data) as definitions['ws.WsMessage'];
      setMessageHistory((prev) => prev.concat(parsedMessage));
    }
  }, [lastMessage]);

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
    sendMessage,
  }
}
