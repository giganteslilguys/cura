defmodule CuraWeb.PageController do
  use CuraWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
