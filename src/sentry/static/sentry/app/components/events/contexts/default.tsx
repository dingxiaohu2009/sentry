import React from 'react';

import ContextBlock from 'app/components/events/contexts/contextBlock';
import {Event} from 'app/types';

type Props = {
  data: Record<string, React.ReactNode | undefined>;
  alias: string;
  event: Event;
};

function getKnownData(data: Props['data']) {
  return Object.entries(data)
    .filter(([k]) => k !== 'type' && k !== 'title')
    .map(([key, value]) => ({
      key,
      subject: key,
      value,
    }));
}

const DefaultContextType = ({data}: Props) => <ContextBlock data={getKnownData(data)} />;

export default DefaultContextType;
