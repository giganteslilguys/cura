defmodule Cura.Conversation.GeminiClient do
  require Logger

  @gemini_url "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

  def call_async(transcript, room_id, order_id) do
    Task.start(fn -> call(transcript, room_id, order_id) end)
  end

  defp call(transcript, room_id, order_id) do
    api_key = Application.fetch_env!(:cura, :gemini_api_key)

    body = %{
      contents: [%{parts: [%{text: transcript}]}]
    }

    case Req.post(@gemini_url, json: body, params: [key: api_key]) do
      {:ok, %{status: 200, body: body}} ->
        response_text =
          get_in(body, ["candidates", Access.at(0), "content", "parts", Access.at(0), "text"])

        Logger.info("[Gemini] room=#{room_id} order=#{order_id} response=#{response_text}")

        CuraWeb.Endpoint.broadcast("conversation:#{room_id}", "gemini_result", %{
          text: response_text,
          order_id: order_id
        })

        {:ok, %{response: response_text, room_id: room_id, order_id: order_id}}

      {:ok, %{status: status, body: body}} ->
        Logger.error(
          "[Gemini] room=#{room_id} order=#{order_id} status=#{status} body=#{inspect(body)}"
        )

        {:error, :bad_status}

      {:error, reason} ->
        Logger.error("[Gemini] room=#{room_id} order=#{order_id} failed=#{inspect(reason)}")
        {:error, reason}
    end
  end
end
