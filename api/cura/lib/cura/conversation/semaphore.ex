defmodule Cura.Conversation.Semaphore do
  use GenServer

  @limit 4

  def start_link(_), do: GenServer.start_link(__MODULE__, @limit, name: __MODULE__)

  def run(fun) do
    :ok = acquire()

    try do
      fun.()
    after
      release()
    end
  end

  defp acquire, do: GenServer.call(__MODULE__, :acquire, 60_000)
  defp release, do: GenServer.cast(__MODULE__, :release)

  @impl true
  def init(limit), do: {:ok, %{available: limit, queue: :queue.new()}}

  @impl true
  def handle_call(:acquire, _from, %{available: n} = state) when n > 0 do
    {:reply, :ok, %{state | available: n - 1}}
  end

  def handle_call(:acquire, from, %{queue: q} = state) do
    {:noreply, %{state | queue: :queue.in(from, q)}}
  end

  @impl true
  def handle_cast(:release, %{available: n, queue: q} = state) do
    case :queue.out(q) do
      {{:value, from}, rest} ->
        GenServer.reply(from, :ok)
        {:noreply, %{state | queue: rest}}

      {:empty, _} ->
        {:noreply, %{state | available: n + 1}}
    end
  end
end
