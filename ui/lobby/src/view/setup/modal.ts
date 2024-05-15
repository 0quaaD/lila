import { MaybeVNode } from 'common/snabbdom';
import { SetupCtrl } from '../../setupCtrl';
import hookView from './hookView';
import friendView from './friendView';
import aiView from './aiView';
//import localContent from './localContent';

const gameTypeToRenderer = {
  hook: hookView,
  friend: friendView,
  ai: aiView,
  //local: localContent,
};

export default function setupModal(ctrl: SetupCtrl): MaybeVNode {
  if (!ctrl.gameType) return null;
  const renderContent = gameTypeToRenderer[ctrl.gameType];
  return site.dialog.snab({
    class: 'game-setup',
    css: [{ hashed: 'lobby.setup' }],
    onClose: ctrl.closeModal,
    vnodes: renderContent(ctrl),
  });
}
