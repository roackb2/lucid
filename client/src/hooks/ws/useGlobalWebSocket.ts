import { useEffect } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { wsUrl } from "../common";
import { useSetAtom } from "jotai";
import { readyStateAtom, messageHistoryAtom, sendJsonMessageAtom } from "@/atoms/websocketAtoms";

export default function useGlobalWebSocket() {
  const setReadyState = useSetAtom(readyStateAtom)
  const setMessageHistory = useSetAtom(messageHistoryAtom)
  const setSendJsonMessage = useSetAtom(sendJsonMessageAtom)

  const { sendJsonMessage: wsSendJsonMessage, lastJsonMessage, readyState: wsReadyState } = useWebSocket(wsUrl, {
    onOpen: () => console.log('opened'),
    // Will attempt to reconnect on all close events, such as server shutting down
    shouldReconnect: (closeEvent) => true,
  });

  useEffect(() => {
    setReadyState(wsReadyState)
  }, [wsReadyState])

  useEffect(() => {
    setSendJsonMessage(wsSendJsonMessage)
  }, [wsSendJsonMessage])

  useEffect(() => {
    if (lastJsonMessage !== null) {
      console.log('lastJsonMessage', lastJsonMessage)
      setMessageHistory((prev) => prev.concat(lastJsonMessage));
    }
  }, [lastJsonMessage]);

  return {}
}
