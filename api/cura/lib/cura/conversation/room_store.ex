defmodule Cura.Conversation.RoomStore do
  use GenServer

  @chunk_trigger 3
  @time_trigger_seconds 30

  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  def append_chunk(room_id, text) do
    GenServer.call(__MODULE__, {:append_chunk, room_id, text})
  end

  @doc """
  Append newly-generated suggestions to the room's running list. Called by
  the Gemini client after a successful response so the next trigger sees
  them in the "already suggested" context.
  """
  def add_suggestions(room_id, suggestions) when is_list(suggestions) do
    GenServer.call(__MODULE__, {:add_suggestions, room_id, suggestions})
  end

  def get_suggestions(room_id) do
    GenServer.call(__MODULE__, {:get_suggestions, room_id})
  end

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call({:append_chunk, room_id, text}, _from, rooms) do
    now = DateTime.utc_now()
    room = Map.get(rooms, room_id, fresh_room(now))

    if room.last_broadcast == text do
      {:reply, :duplicate, rooms}
    else
      updated = %{
        room
        | transcript: room.transcript <> " " <> text,
          chunk_count: room.chunk_count + 1,
          last_broadcast: text
      }

      elapsed = DateTime.diff(now, updated.last_triggered_at || updated.started_at, :second)
      should_trigger = updated.chunk_count >= @chunk_trigger or elapsed >= @time_trigger_seconds

      {final, result} =
        if should_trigger do
          order = updated.gemini_call_order + 1

          {%{updated | chunk_count: 0, last_triggered_at: now, gemini_call_order: order},
           {:trigger, updated.transcript, updated.suggestions, order}}
        else
          {updated, :noop}
        end

      {:reply, result, Map.put(rooms, room_id, final)}
    end
  end

  def handle_call({:add_suggestions, room_id, suggestions}, _from, rooms) do
    room = Map.get(rooms, room_id, fresh_room(DateTime.utc_now()))
    updated = %{room | suggestions: room.suggestions ++ suggestions}
    {:reply, :ok, Map.put(rooms, room_id, updated)}
  end

  def handle_call({:get_suggestions, room_id}, _from, rooms) do
    room = Map.get(rooms, room_id, fresh_room(DateTime.utc_now()))
    {:reply, room.suggestions, rooms}
  end

  defp fresh_room(now) do
    %{
      transcript: "",
      chunk_count: 0,
      started_at: now,
      last_triggered_at: nil,
      gemini_call_order: 0,
      last_broadcast: nil,
      suggestions: []
    }
  end
end
