defmodule Cura.Conversation.RoomStore do
  use GenServer

  @chunk_trigger 3
  @time_trigger_seconds 30

  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  def append_chunk(room_id, text) do
    GenServer.call(__MODULE__, {:append_chunk, room_id, text})
  end

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call({:append_chunk, room_id, text}, _from, rooms) do
    now = DateTime.utc_now()

    room =
      Map.get(rooms, room_id, %{
        transcript: "",
        chunk_count: 0,
        started_at: now,
        last_triggered_at: nil,
        gemini_call_order: 0
      })

    updated = %{
      room
      | transcript: room.transcript <> " " <> text,
        chunk_count: room.chunk_count + 1
    }

    elapsed = DateTime.diff(now, updated.last_triggered_at || updated.started_at, :second)
    should_trigger = updated.chunk_count >= @chunk_trigger or elapsed >= @time_trigger_seconds

    {final, result} =
      if should_trigger do
        order = updated.gemini_call_order + 1

        {%{updated | chunk_count: 0, last_triggered_at: now, gemini_call_order: order},
         {:trigger, updated.transcript, order}}
      else
        {updated, :noop}
      end

    {:reply, result, Map.put(rooms, room_id, final)}
  end
end
