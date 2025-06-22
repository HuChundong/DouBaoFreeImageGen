# Use an official Python runtime as a parent image
FROM python:3.12-slim

# Set the working directory in the container
WORKDIR /app

# Copy the dependencies file to the working directory
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
# Using --no-cache-dir to reduce image size
RUN pip config set global.index-url https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple && pip install --no-cache-dir -r requirements.txt

# Copy the content of the local src directory to the working directory
COPY server.py .

# Expose the ports the app runs on
EXPOSE 8080
EXPOSE 8081

# Define the command to run the application
CMD ["python", "server.py"] 