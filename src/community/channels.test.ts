import { describe, expect, it } from 'vitest'
import { channelFromPath, channelPath, channelRoomName, COMMUNITY_CHANNELS } from './channels'

describe('community channels', () => {
  it('defines the isolated launch channels and stable room names', () => {
    expect(COMMUNITY_CHANNELS.map((channel) => channel.id)).toEqual(['general', 'showcases', 'feedback'])
    expect(channelRoomName('feedback')).toBe('vibecodingtribe.com/channel/feedback')
  })

  it('maps every community route to the combined General channel', () => {
    expect(channelFromPath('/')).toBe('general')
    expect(channelFromPath('/r/general')).toBe('general')
    expect(channelFromPath('/missions')).toBe('general')
    expect(channelFromPath('/exchange')).toBe('general')
    expect(channelFromPath('/c/showcases')).toBe('general')
    expect(channelFromPath('/c/feedback')).toBe('general')
    expect(channelFromPath('/c/unknown')).toBe('general')
    expect(channelPath('feedback')).toBe('/c/feedback')
  })
})
