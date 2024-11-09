import { ReadyState } from 'react-use-websocket';

interface StatusIndicatorProps {
  status: ReadyState;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
  const getStatusColor = (status: ReadyState) => {
    switch (status) {
      case ReadyState.OPEN:
        return 'bg-green-500';
      case ReadyState.CLOSED:
        return 'bg-red-500';
      case ReadyState.CONNECTING:
        return 'bg-yellow-500';
      case ReadyState.CLOSING:
        return 'bg-orange-500';
      case ReadyState.UNINSTANTIATED:
        return 'bg-gray-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div
      className={`
        w-3 h-3 rounded-full
        ${getStatusColor(status)}
      `}
    />
  );
};

export default StatusIndicator;
