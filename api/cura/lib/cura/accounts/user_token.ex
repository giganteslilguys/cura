defmodule Cura.Accounts.UserToken do
  use Ecto.Schema
  import Ecto.Query
  alias Cura.Accounts.UserToken

  @rand_size 32
  @session_validity_in_days 60

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "users_tokens" do
    field :token, :binary
    field :context, :string
    belongs_to :user, Cura.Accounts.User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc """
  Generates a session token. Returns `{encoded_token, user_token_struct}`.

  The encoded token (base64url) is what we send to clients; the raw bytes are
  stored in the database.
  """
  def build_session_token(user) do
    raw = :crypto.strong_rand_bytes(@rand_size)
    encoded = Base.url_encode64(raw, padding: false)
    {encoded, %UserToken{token: raw, context: "session", user_id: user.id}}
  end

  @doc """
  Looks up a user from a base64url-encoded session token.
  """
  def verify_session_token_query(encoded_token) do
    case Base.url_decode64(encoded_token, padding: false) do
      {:ok, raw} ->
        query =
          from t in UserToken,
            join: u in assoc(t, :user),
            where: t.token == ^raw and t.context == "session",
            where: t.inserted_at > ago(@session_validity_in_days, "day"),
            select: u

        {:ok, query}

      :error ->
        :error
    end
  end

  @doc """
  Returns the query for deleting a session token by its encoded value.
  """
  def by_encoded_token_query(encoded_token) do
    case Base.url_decode64(encoded_token, padding: false) do
      {:ok, raw} -> {:ok, from(t in UserToken, where: t.token == ^raw and t.context == "session")}
      :error -> :error
    end
  end
end
