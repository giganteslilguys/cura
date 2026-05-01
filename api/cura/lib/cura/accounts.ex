defmodule Cura.Accounts do
  @moduledoc """
  The Accounts context. Handles user registration, authentication, and session
  tokens for the JSON API.
  """

  import Ecto.Query, warn: false
  alias Cura.Repo
  alias Cura.Accounts.{User, UserToken}

  @doc """
  Registers a new user.
  """
  def register_user(attrs) do
    %User{}
    |> User.registration_changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Returns a changeset for tracking user registration changes.
  """
  def change_user_registration(%User{} = user, attrs \\ %{}) do
    User.registration_changeset(user, attrs)
  end

  @doc """
  Gets a user by email.
  """
  def get_user_by_email(email) when is_binary(email) do
    Repo.get_by(User, email: email)
  end

  @doc """
  Gets a user by email and password.
  """
  def get_user_by_email_and_password(email, password)
      when is_binary(email) and is_binary(password) do
    user = Repo.get_by(User, email: email)
    if User.valid_password?(user, password), do: user
  end

  @doc """
  Gets a user by id.
  """
  def get_user!(id), do: Repo.get!(User, id)

  ## Session

  @doc """
  Generates a session token and returns its encoded form (to send to clients).
  """
  def generate_user_session_token(user) do
    {encoded, user_token} = UserToken.build_session_token(user)
    Repo.insert!(user_token)
    encoded
  end

  @doc """
  Fetches a user by an encoded session token.
  """
  def fetch_user_by_session_token(encoded_token) when is_binary(encoded_token) do
    with {:ok, query} <- UserToken.verify_session_token_query(encoded_token),
         %User{} = user <- Repo.one(query) do
      {:ok, user}
    else
      _ -> :error
    end
  end

  def fetch_user_by_session_token(_), do: :error

  @doc """
  Deletes the given encoded session token.
  """
  def delete_user_session_token(encoded_token) when is_binary(encoded_token) do
    case UserToken.by_encoded_token_query(encoded_token) do
      {:ok, query} -> Repo.delete_all(query)
      :error -> {0, nil}
    end

    :ok
  end

  def delete_user_session_token(_), do: :ok
end
