import { describe, expect, it } from 'vitest'
import { channelFromPath, channelPath, channelRoomName, COMMUNITY_CHANNELS } from './channels'

describe('community channels', () => {
  it('defines the isolated launch channels and stable room names', () => {
    expect(COMMUNITY_CHANNELS.map((channel) => channel.id)).toEqual(['general', 'showcases', 'feedback'])
    expect(channelRoomName('feedback')).toBe('vibecodingtribe.com/channel/feedback')
  })

  it('maps legacy routes to canonical channel state', () => {
    expect(channelFromPath('/')).toBe('general')
    expect(channelFromPath('/r/general')).toBe('general')
    expect(channelFromPath('/missions')).toBe('feedback')
    expect(channelFromPath('/exchange')).toBe('feedback')
    expect(channelFromPath('/c/showcases')).toBe('showcases')
    expect(channelFromPath('/c/unknown')).toBe('general')
    expect(channelPath('feedback')).toBe('/c/feedback')
  })
})
