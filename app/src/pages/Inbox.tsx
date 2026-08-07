import { useConversationList } from '../lib/useConversationList'
import ConversationList from '../components/ConversationList'
import ChatThread from '../components/ChatThread'

export default function Inbox() {
  const { conversations } = useConversationList()

  return (
    <div className="h-full flex">
      <ConversationList conversations={conversations} />
      <ChatThread />
    </div>
  )
}
