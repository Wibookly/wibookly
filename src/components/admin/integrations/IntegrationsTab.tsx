import { useState } from 'react';
import { IntegrationsSidebar, type SelectedNode } from './IntegrationsSidebar';
import { ProviderDetail } from './ProviderDetail';
import { SubServiceDetail } from './SubServiceDetail';
import { FeatureDetail } from './FeatureDetail';
import { AIOverviewHub } from './AIOverviewHub';

export default function IntegrationsTabV2(_props: { adminInvoke?: any; organizationId?: string | null }) {
  const [selected, setSelected] = useState<SelectedNode>({ type: 'provider', id: 'microsoft' });

  return (
    <div className="flex gap-5 items-start">
      <IntegrationsSidebar selected={selected} onSelect={setSelected} />
      <main className="flex-1 min-w-0">
        {selected.type === 'provider' && <ProviderDetail id={selected.id} onSelect={setSelected} />}
        {selected.type === 'sub' && <SubServiceDetail id={selected.id} onSelect={setSelected} />}
        {selected.type === 'feature' && <FeatureDetail id={selected.id} onSelect={setSelected} />}
        {selected.type === 'hub' && <AIOverviewHub onSelect={setSelected} />}
      </main>
    </div>
  );
}
